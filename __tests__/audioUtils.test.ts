import { describe, it, expect } from 'vitest';
import { downsampleBuffer, base64ToUint8Array, uint8ArrayToBase64 } from '../utils/audioUtils';

describe('Audio Utilities', () => {
  describe('downsampleBuffer', () => {
    it('should return original buffer if rates match', () => {
      const input = new Float32Array([1, 2, 3]);
      const output = downsampleBuffer(input, 16000, 16000);
      expect(output).toEqual(input);
    });

    it('should downsample by factor of 2', () => {
      // Input: 4 samples, Rate 32000
      // Target: Rate 16000
      // Expected: 2 samples (average of pairs)
      const input = new Float32Array([1.0, 1.0, 0.5, 0.5]);
      const output = downsampleBuffer(input, 32000, 16000);
      
      expect(output.length).toBe(2);
      expect(output[0]).toBeCloseTo(1.0);
      expect(output[1]).toBeCloseTo(0.5);
    });
  });

  describe('Base64 Conversion', () => {
    it('should round trip convert correctly', () => {
      const input = new Uint8Array([0, 128, 255]);
      const b64 = uint8ArrayToBase64(input);
      const output = base64ToUint8Array(b64);
      
      expect(output.length).toBe(3);
      expect(output[0]).toBe(0);
      expect(output[1]).toBe(128);
      expect(output[2]).toBe(255);
    });
  });
});