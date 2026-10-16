import fs from 'fs';
import fsPromises from 'fs/promises';
import mime from 'mime';
import { NextApiRequest, NextApiResponse } from 'next';
import nullthrows from 'nullthrows';
import path from 'path';

import {
  getLatestUpdateBundlePathForRuntimeVersionAsync,
  getMetadataAsync,
} from '../../common/helpers';

export default async function assetsEndpoint(req: NextApiRequest, res: NextApiResponse) {
  const { asset: assetName, runtimeVersion, platform } = req.query;
  const appSlug = req.query.app ?? process.env.OTA_DEFAULT_APP_SLUG ?? 'rntest';

  if (!assetName || typeof assetName !== 'string') {
    res.statusCode = 400;
    res.json({ error: 'No asset name provided.' });
    return;
  }

  if (platform !== 'ios' && platform !== 'android') {
    res.statusCode = 400;
    res.json({ error: 'No platform provided. Expected "ios" or "android".' });
    return;
  }

  if (!runtimeVersion || typeof runtimeVersion !== 'string') {
    res.statusCode = 400;
    res.json({ error: 'No runtimeVersion provided.' });
    return;
  }
  if (typeof appSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(appSlug)) {
    res.statusCode = 400;
    res.json({ error: 'Invalid app slug.' });
    return;
  }

  let updateBundlePath: string;
  try {
    updateBundlePath = await getLatestUpdateBundlePathForRuntimeVersionAsync(
      runtimeVersion,
      appSlug,
    );
  } catch (error: any) {
    res.statusCode = 404;
    res.json({
      error: error.message,
    });
    return;
  }

  const { metadataJson } = await getMetadataAsync({
    updateBundlePath,
    runtimeVersion,
  });

  const assetPath = path.resolve(updateBundlePath, assetName);
  if (!assetPath.startsWith(`${updateBundlePath}${path.sep}`)) {
    res.statusCode = 400;
    res.json({ error: 'Invalid asset path.' });
    return;
  }
  const assetMetadata = metadataJson.fileMetadata[platform].assets.find(
    (asset: any) => asset.path === assetName,
  );
  const isLaunchAsset = metadataJson.fileMetadata[platform].bundle === assetName;
  if (!assetMetadata && !isLaunchAsset) {
    res.statusCode = 404;
    res.json({ error: `Asset "${assetName}" is not part of the selected update.` });
    return;
  }

  if (!fs.existsSync(assetPath)) {
    res.statusCode = 404;
    res.json({ error: `Asset "${assetName}" does not exist.` });
    return;
  }

  try {
    const asset = await fsPromises.readFile(assetPath, null);

    res.statusCode = 200;
    res.setHeader(
      'content-type',
      isLaunchAsset ? 'application/javascript' : nullthrows(mime.getType(assetMetadata.ext)),
    );
    res.end(asset);
  } catch (error) {
    console.log(error);
    res.statusCode = 500;
    res.json({ error });
  }
}
