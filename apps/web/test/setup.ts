import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Unmount whatever a test rendered, so one test's screen never leaks into the next.
afterEach(() => cleanup());
