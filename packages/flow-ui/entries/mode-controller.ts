import { createModeController } from '../src/modeController';
import type { InstallationProfile } from '@lumin/contracts';
declare const __MODE_PROFILE__: InstallationProfile;
createModeController({ profile: __MODE_PROFILE__ });
