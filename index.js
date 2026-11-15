import { registerRootComponent } from 'expo';

import App from './App';
import React from 'react';
import WebErrorBoundary from './components/WebErrorBoundary';

const RootApp = () => <WebErrorBoundary><App /></WebErrorBoundary>;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(RootApp);
