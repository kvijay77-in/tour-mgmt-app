import * as Haptics from 'expo-haptics';

async function playLocalSound(asset: number | string) {
  try {
    // Use dynamic import to avoid static compile-time failure if the package name differs.
    // `expo-audio` provides an Audio API similar to expo-av in SDK 57.
    // Fallback to no-op if audio can't be played.
    const mod = await import('expo-audio');
    const AudioModule: any = (mod as any).Audio ?? (mod as any).default ?? mod;
    const SoundCtor: any = AudioModule?.Sound ?? AudioModule;
    if (!SoundCtor || typeof SoundCtor !== 'function') {
      // Can't find a compatible Sound constructor — bail out gracefully.
      return;
    }

    const sound = new SoundCtor.Sound ? new SoundCtor.Sound() : new SoundCtor();
    await sound.loadAsync(asset as unknown as number);
    await sound.playAsync();
    // do not unload immediately; let system manage caching
  } catch {
    // Best-effort audio playback; log and continue.
  }
}

export async function playSuccess() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {}
  void playLocalSound(require('../../../assets/sounds/success.mp3') as unknown as number);
}

export async function playFailure(kind: 'error' | 'warning' = 'error') {
  try {
    await Haptics.notificationAsync(kind === 'error' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Warning);
  } catch {}
  void playLocalSound(require('../../../assets/sounds/error.mp3') as unknown as number);
}

export async function playScanTick() {
  try {
    await Haptics.selectionAsync();
  } catch {}
}

export default {
  playSuccess,
  playFailure,
  playScanTick,
};
