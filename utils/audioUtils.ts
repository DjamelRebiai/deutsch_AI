import { Blob } from '@google/genai';

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  srcSampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  
  // Create a buffer at the source sample rate (24kHz).
  // When played on a system context (e.g. 48kHz), the browser handles resampling automatically.
  const buffer = ctx.createBuffer(numChannels, frameCount, srcSampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      // Normalize 16-bit integer to float [-1.0, 1.0]
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

/**
 * Downsamples audio buffer to target sample rate (default 16kHz).
 * Uses simple averaging (box filter) which is sufficient for real-time voice.
 */
export function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, targetSampleRate: number = 16000): Float32Array {
  if (inputSampleRate === targetSampleRate) {
    return buffer;
  }
  
  if (inputSampleRate < targetSampleRate) {
    // Fallback for unlikely case where mic is lower quality than 16kHz
    // Just returning original buffer to prevent audio loss/artifacts, 
    // though pitch might be off if API expects strictly 16k.
    // Ideally we would upsample, but linear interpolation is expensive here.
    return buffer;
  }
  
  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.ceil(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  
  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  
  return result;
}

/**
 * Converts Float32 audio data to 16-bit PCM Blob for Gemini API.
 * Target format: Linear16, 16kHz, Mono.
 */
export function createPcmBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Clamp values to [-1, 1] to prevent wrapping artifacts
    const s = Math.max(-1, Math.min(1, data[i]));
    // Convert float [-1.0, 1.0] to int16 [-32768, 32767]
    int16[i] = s < 0 ? s * 32768 : s * 32767;
  }
  
  // Important: Int16Array is platform-endian, but typically Little Endian on web.
  // Gemini expects Little Endian.
  return {
    data: uint8ArrayToBase64(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}