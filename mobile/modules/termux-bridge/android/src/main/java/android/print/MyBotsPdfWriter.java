package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import java.io.File;

/**
 * Writes a WebView's print document to a PDF file without the print dialog. The result callbacks have
 * package-private constructors in the SDK, so this class lives in android.print (as react-native-html-to-pdf does).
 */
public final class MyBotsPdfWriter {
  public interface Done { void finished(String error); }

  private MyBotsPdfWriter() {}

  public static void write(final PrintDocumentAdapter adapter, final File out, final Done done) {
    // Margins come from the page's CSS (@page), so the print attributes add none.
    final PrintAttributes attributes = new PrintAttributes.Builder()
      .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
      .setResolution(new PrintAttributes.Resolution("mybots", "MyBots", 300, 300))
      .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
      .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
      .build();
    adapter.onLayout(null, attributes, null, new PrintDocumentAdapter.LayoutResultCallback() {
      @Override public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
        android.util.Log.i("mybots-pdf", "paginado");
        final ParcelFileDescriptor descriptor;
        try {
          descriptor = ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
        } catch (Exception error) { done.finished("Não consegui criar o arquivo PDF."); return; }
        adapter.onWrite(new PageRange[] { PageRange.ALL_PAGES }, descriptor, new CancellationSignal(), new PrintDocumentAdapter.WriteResultCallback() {
          @Override public void onWriteFinished(PageRange[] pages) { android.util.Log.i("mybots-pdf", "escrito"); close(descriptor); done.finished(null); }
          @Override public void onWriteFailed(CharSequence error) { close(descriptor); done.finished("Falha ao gerar o PDF: " + error); }
          @Override public void onWriteCancelled() { close(descriptor); done.finished("A geração do PDF foi cancelada."); }
        });
      }
      @Override public void onLayoutFailed(CharSequence error) { done.finished("Falha ao paginar o PDF: " + error); }
      @Override public void onLayoutCancelled() { done.finished("A geração do PDF foi cancelada."); }
    }, null);
  }

  private static void close(ParcelFileDescriptor descriptor) { try { descriptor.close(); } catch (Exception ignored) {} }
}
