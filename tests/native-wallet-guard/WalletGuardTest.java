import android.content.Context;
import android.content.SharedPreferences;
import expo.modules.termuxbridge.WalletGuard;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

public class WalletGuardTest {
  static class Memory extends Context implements SharedPreferences {
    final Map<String, Object> values = new HashMap<>();
    public SharedPreferences getSharedPreferences(String name, int mode) { return this; }
    public String getString(String key, String fallback) { return (String) values.getOrDefault(key, fallback); }
    public boolean getBoolean(String key, boolean fallback) { return (Boolean) values.getOrDefault(key, fallback); }
    public long getLong(String key, long fallback) { return (Long) values.getOrDefault(key, fallback); }
    public Editor edit() { return new Editor() {
      final Map<String, Object> pending = new HashMap<>();
      public Editor putString(String key, String value) { pending.put(key, value); return this; }
      public Editor putBoolean(String key, boolean value) { pending.put(key, value); return this; }
      public Editor putLong(String key, long value) { pending.put(key, value); return this; }
      public boolean commit() { values.putAll(pending); return true; }
    }; }
  }
  public static void main(String[] args) throws Exception {
    var guard = WalletGuard.INSTANCE; var context = new Memory();
    if (!guard.rules(context).getBoolean("frozen") || guard.generation(context) != 0) throw new AssertionError("default must be frozen");
    guard.saveFromEditor(context, new JSONObject().put("perPurchase", 1000), false, 0);
    if (guard.rules(context).getBoolean("frozen") || guard.generation(context) != 1) throw new AssertionError("editor save");
    var snapshot = guard.snapshot(context); var started = new CountDownLatch(1); var frozen = new CountDownLatch(1);
    var error = new AtomicReference<Throwable>();
    Thread editor = new Thread(() -> { try {
      started.countDown(); frozen.await(); guard.saveFromEditor(context, new JSONObject().put("perPurchase", 2000), false, snapshot.getSecond());
      error.set(new AssertionError("stale editor reopened wallet"));
    } catch (IllegalArgumentException expected) { } catch (Throwable failure) { error.set(failure); } });
    editor.start(); started.await(); guard.freeze(context); frozen.countDown(); editor.join();
    if (error.get() != null) throw new AssertionError(error.get());
    if (!guard.rules(context).getBoolean("frozen") || guard.generation(context) != 2 || guard.rules(context).getLong("perPurchase") != 1000)
      throw new AssertionError("freeze must win against a stale editor");
    System.out.println("WalletGuard: padrão congelado, geração e congelamento concorrente: OK");
  }
}
