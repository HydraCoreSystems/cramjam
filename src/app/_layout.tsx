import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProvider } from "../state/AppProvider";
import { C } from "../theme";

export default function Layout() {
  return (
    <AppProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.ink } }}>
        <Stack.Screen name="paywall" options={{ presentation: "modal" }} />
      </Stack>
    </AppProvider>
  );
}
