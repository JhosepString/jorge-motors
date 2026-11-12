import type { Request } from 'express';
import { AppError } from '../../../shared/app-error.js';
import type { DeviceProof } from './device-proof.js';

export function requestDeviceProof(req: Request): DeviceProof {
  const deviceId = req.header('X-Device-Id');
  const time = req.header('X-Device-Time');
  const nonce = req.header('X-Device-Nonce');
  const signature = req.header('X-Device-Signature');
  if (!deviceId || !time || !nonce || !signature)
    throw new AppError(403, 'DEVICE_PROOF_REQUIRED', 'Se requiere la firma del equipo.');
  return { deviceId, time, nonce, signature };
}
