import { z } from 'zod';

const token = z.string().min(1).max(4096);

export const LoginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
  deviceId: z.string().min(8).max(128),
  appVersion: z.string().max(32).optional(),
  totp: z.string().regex(/^\d{6}$/).optional(),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({ refreshToken: token });
export type RefreshInput = z.infer<typeof RefreshSchema>;
