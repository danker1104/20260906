import { getPublicationMode, NationalLibraryConfigError, type NationalLibraryProvider } from './provider';
import { mockNationalLibraryProvider } from './mock-provider';
import { liveNationalLibraryProvider } from './live-provider';
import { createCachedNationalLibraryProvider } from './provider-cache';

let cachedLiveProvider: NationalLibraryProvider | undefined;

export function getNationalLibraryProvider(): NationalLibraryProvider {
  const mode = getPublicationMode();
  if (mode === 'live') {
    if (!process.env.NL_API_KEY?.trim()) throw new NationalLibraryConfigError();
    cachedLiveProvider ??= createCachedNationalLibraryProvider(liveNationalLibraryProvider);
    return cachedLiveProvider;
  }
  return mockNationalLibraryProvider;
}
