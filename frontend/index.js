import { registerRootComponent } from 'expo';

import App from './App';
import appConfig from './app.json';
import React from 'react';
import { Platform, SafeAreaView } from 'react-native';
import WebErrorBoundary from './components/WebErrorBoundary';

if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.title = appConfig.expo.name;
}

const RootApp = () => {
  const app = <WebErrorBoundary><App /></WebErrorBoundary>;

  return Platform.OS === 'ios' ? (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#EAF1FF' }}>
      {app}
    </SafeAreaView>
  ) : app;
};

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(RootApp);
