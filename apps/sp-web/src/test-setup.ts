import '@angular/compiler';
import { NgModule } from '@angular/core';
import { getTestBed, ɵgetCleanupHook as getCleanupHook } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach, beforeEach } from 'vitest';

const ANGULAR_TESTBED_SETUP = Symbol.for('sp-web.angular-testbed-setup');
const globalState = globalThis as typeof globalThis & Record<symbol, boolean | undefined>;

beforeEach(getCleanupHook(false));
afterEach(getCleanupHook(true));

if (!globalState[ANGULAR_TESTBED_SETUP]) {
  globalState[ANGULAR_TESTBED_SETUP] = true;

  @NgModule({})
  class TestModule {}

  getTestBed().initTestEnvironment(
    [BrowserTestingModule, TestModule],
    platformBrowserTesting(),
    {
      errorOnUnknownElements: true,
      errorOnUnknownProperties: true,
    },
  );
}
