/**
 * Trackit X — root layout.
 *
 * The provider stack for the whole application. Order is not cosmetic here:
 *
 *   GestureHandlerRootView   BottomSheet's pan gesture needs a root; without it
 *                            the sheet silently refuses to drag on Android.
 *   SafeAreaProvider         ScreenContainer and the shell read insets. A missing
 *                            provider is a runtime throw, not a layout glitch.
 *   ThemeProvider            Everything below it reads tokens.
 *   ToastProvider            Renders above the navigator so a confirmation is not
 *                            clipped by a screen transition.
 *   AuthProvider             Owns the Supabase session.
 *   OrganizationProvider     Reads the session, so it must be nested inside.
 *
 * The last two are the only hard dependency: `OrganizationProvider` calls
 * `useAuth()`, so inverting them throws on first render.
 *
 * No splash-screen API is called. Expo hides the native splash once the first
 * frame renders, and that first frame is `BrandSplash` — so the handoff is a
 * cross-fade between two dark screens rather than a gap to be managed in JS.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/contexts/AuthContext';
import { OrganizationProvider } from '@/contexts/OrganizationContext';
import { ThemeProvider, ToastProvider, useTheme } from '@/design-system';

const styles = StyleSheet.create({
  root: { flex: 1 },
});

/**
 * Split out because the navigator needs theme tokens, which only exist below
 * `ThemeProvider`.
 */
function ThemedNavigator() {
  const theme = useTheme();

  return (
    <>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          // Every screen draws its own header through ScreenContainer, so the
          // navigator's header would be a second, inconsistent one.
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.canvas },
          // Fade rather than a horizontal push: the top-level moves in this app
          // are zone changes (auth → onboarding → app), not drill-downs, and a
          // slide implies a back gesture that does not exist between zones.
          animation: 'fade',
        }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {/*
          AsyncStorage satisfies ThemeStorage structurally (`getItem` /
          `setItem` returning promises), so no adapter is needed. On web it is
          backed by localStorage, which is why the chosen theme survives a reload
          there too.
        */}
        <ThemeProvider storage={AsyncStorage}>
          <ToastProvider>
            <AuthProvider>
              <OrganizationProvider>
                <ThemedNavigator />
              </OrganizationProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
