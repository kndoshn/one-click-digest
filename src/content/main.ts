// Content script entry point, bundled into dist/content/main.js (an IIFE). On every toolbar click
// the background worker injects third_party/readability/Readability.js and then this bundle into
// the active tab, so each click starts from fresh module state.

import { bootstrap } from './controller.ts';

bootstrap();
