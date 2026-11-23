export async function onRequest(context) {
  const assetUrl = new URL('/video.html', context.request.url);
  return context.env.ASSETS.fetch(assetUrl);
}
