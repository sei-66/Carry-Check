import { interpolatePose, type Pose } from '../domain/pose';

// Equal time per verified segment. This is a display timeline, not physical speed.
export function poseAtProgress(
  poses: readonly Pose[],
  progress: number,
): Pose | undefined {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1)
    throw new Error('Invalid playback position');
  if (poses.length === 0) return undefined;
  if (poses.length === 1 || progress === 1) return poses.at(-1);
  const position = progress * (poses.length - 1);
  const index = Math.floor(position);
  const start = poses[index];
  const end = poses[index + 1];
  return start && end
    ? interpolatePose(start, end, position - index)
    : undefined;
}
