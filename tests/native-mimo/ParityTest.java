import java.nio.file.*;
import org.json.*;

/** Runs MimoSim.dump for each case of the JSON file and prints the answers as a JSON array (tests/mimo-native.test.mjs compares them with the JavaScript). */
public class ParityTest {
  public static void main(String[] args) throws Exception {
    String data = new String(Files.readAllBytes(Paths.get(args[0])), "UTF-8");
    JSONArray cases = new JSONArray(new String(Files.readAllBytes(Paths.get(args[1])), "UTF-8")), out = new JSONArray();
    for (int i = 0; i < cases.length(); i++) {
      JSONObject c = cases.getJSONObject(i);
      out.put(new JSONObject(expo.modules.termuxbridge.MimoSim.dump(data, c.getJSONObject("spec").toString(), c.getString("mood"), c.getInt("steps"), c.getInt("n"), c.getDouble("w"), c.getDouble("h"), c.getBoolean("light"))));
    }
    System.out.println(out.toString());
  }
}
