// Vitest global setup.
//
// Extends `expect` with @testing-library/jest-dom matchers (toBeInTheDocument,
// toBeDisabled, toHaveTextContent, …). This only augments the matcher set — it
// does not require a DOM at import time, so it is harmless for the Node-environment
// suites and active for the jsdom component suites.
import '@testing-library/jest-dom/vitest'
