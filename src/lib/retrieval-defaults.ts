/**
 * The retrieval window, shared by the widget and the route.
 *
 * These lived twice, once in the component and once in the config resolver,
 * each with its own fallback for the same environment variable. On the
 * deployed demo neither variable was set, so the slider ran to 25 while the
 * route clamped at 10: dragging it to 25 showed 25 and returned 10. A control
 * that reports a number the server does not honour is worse than no control.
 *
 * Client and server read the same variables, so the fallbacks have to live in
 * one place. This module holds numbers only and imports nothing, which is what
 * makes it safe for the browser bundle.
 */
export const CLIENT_DEFAULT_K = 5;
export const CLIENT_MAX_K = 10;
