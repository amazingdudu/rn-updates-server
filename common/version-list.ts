import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export type UpdateVersion = {
  runtime: string;
  release: string;
  updateId: string | null;
  createdAt: string;
  message: string;
  platforms: string[];
  kind: 'update' | 'rollback' | 'invalid';
  latest: boolean;
};

export async function readVersions(root = path.resolve('updates')): Promise<UpdateVersion[]> {
  let runtimes;
  try {
    runtimes = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const groups = await Promise.all(
    runtimes
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(async (runtime) => {
        const runtimePath = path.join(root, runtime.name);
        const releases = (await fs.readdir(runtimePath, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .sort((a, b) => parseInt(b.name, 10) - parseInt(a.name, 10));
        return await Promise.all(
          releases.map(async (release, index): Promise<UpdateVersion> => {
            const directory = path.join(runtimePath, release.name);
            const info = await fs.stat(directory);
            const result: UpdateVersion = {
              runtime: runtime.name,
              release: release.name,
              updateId: null,
              createdAt: info.birthtime.toISOString(),
              message: '',
              platforms: [],
              kind: 'invalid',
              latest: index === 0,
            };
            try {
              const files = await fs.readdir(directory);
              if (files.includes('rollback')) {
                result.kind = 'rollback';
                result.createdAt = (
                  await fs.stat(path.join(directory, 'rollback'))
                ).birthtime.toISOString();
                return result;
              }
              const metadataPath = path.join(directory, 'metadata.json');
              const bytes = await fs.readFile(metadataPath);
              const metadata = JSON.parse(bytes.toString('utf8'));
              const hash = crypto.createHash('sha256').update(bytes).digest('hex');
              result.updateId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
              result.createdAt = (await fs.stat(metadataPath)).birthtime.toISOString();
              result.platforms = ['android', 'ios'].filter(
                (platform) => metadata.fileMetadata?.[platform]?.bundle,
              );
              result.message =
                typeof metadata.updateInfo?.message === 'string' ? metadata.updateInfo.message : '';
              result.kind = result.platforms.length ? 'update' : 'invalid';
            } catch {
              // Keep incomplete historical directories visible without breaking the entire page.
            }
            return result;
          }),
        );
      }),
  );
  return groups.flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
