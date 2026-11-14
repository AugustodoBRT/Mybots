package expo.modules.termuxbridge

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.spec.MGF1ParameterSpec
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

// Pairing token, port and secrets key, shared by the module and the notification listener.
internal fun pairingPreferences(context: Context): android.content.SharedPreferences {
  val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
  return EncryptedSharedPreferences.create(context, "mybots_pairing", key,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
}

// The pair script encrypts the supervisor token to this key, so the token never crosses RUN_COMMAND in clear.
internal fun transportKeys(): KeyStore {
  val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  if (!store.containsAlias("mybots_pair_transport")) {
    val digest = if (Build.VERSION.SDK_INT >= 35) KeyProperties.DIGEST_SHA256 else KeyProperties.DIGEST_SHA1
    val builder = KeyGenParameterSpec.Builder("mybots_pair_transport", KeyProperties.PURPOSE_DECRYPT)
      .setKeySize(2048).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP).setDigests(digest)
    if (Build.VERSION.SDK_INT >= 35) builder.setMgf1Digests(KeyProperties.DIGEST_SHA256)
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore").apply {
      initialize(builder.build()); generateKeyPair()
    }
  }
  return store
}

internal fun transportPublicKey(): String = Base64.encodeToString(transportKeys().getCertificate("mybots_pair_transport").publicKey.encoded, Base64.NO_WRAP)
internal fun transportDigest(): String = if (Build.VERSION.SDK_INT >= 35) "sha256" else "sha1"

/** Decrypts the pair script's envelope and keeps token, port and release in the protected preferences. */
internal fun storePairing(context: Context, encrypted: String, port: Int, release: String): String {
  val digest = if (Build.VERSION.SDK_INT >= 35) "SHA-256" else "SHA-1"
  val cipher = Cipher.getInstance("RSA/ECB/OAEPPadding")
  cipher.init(Cipher.DECRYPT_MODE, transportKeys().getKey("mybots_pair_transport", null),
    OAEPParameterSpec(digest, "MGF1", MGF1ParameterSpec(digest), PSource.PSpecified.DEFAULT))
  val token = String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8)
  if (!token.matches(Regex("[0-9a-f]{64}")) || port !in 1024..65535 || !release.matches(Regex("[0-9a-f]{64}"))) throw IllegalArgumentException("Pareamento inválido.")
  if (!pairingPreferences(context).edit().putString("token", token).putInt("port", port).putString("release", release).commit()) throw IllegalStateException("Não consegui guardar o pareamento protegido.")
  return token
}
