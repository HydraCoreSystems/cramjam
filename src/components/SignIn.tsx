import * as Apple from "expo-apple-authentication";
import { Platform, View } from "react-native";
import { useStore } from "../state/AppProvider";
import { Note } from "./ui";

/** Sign in with Apple. Required before the first Study Build. It is the only account. */
export function SignIn({ onDone }: { onDone: () => void }) {
  const store = useStore();
  if (Platform.OS !== "ios") {
    return <Note tone="warn" title="SIGN IN WITH APPLE">Making a new study set needs Sign in with Apple, which is available on iPhone and iPad. Everything you've already built still works here.</Note>;
  }
  return (
    <View style={{ gap: 10 }}>
      <Note title="ONE QUICK STEP">Sign in with Apple before your first Study Build. It is the only account: no password and no email. It lets CramJam keep your allowance straight.</Note>
      <Apple.AppleAuthenticationButton
        buttonType={Apple.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={Apple.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={16}
        style={{ height: 54 }}
        onPress={async () => { if (await store.signIn()) onDone(); }}
      />
    </View>
  );
}
