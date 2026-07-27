// Password-gated: returns a single pending/approved photo as raw binary.
// Split out from list-pending/list-approved because inlining every photo
// as a base64 data URL into one combined response hits Netlify's 6MB
// function response cap as soon as more than one or two are pending at
// once -- this way each photo is its own small request instead.
const { sheetsStore, isAuthed } = require('./lib/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  if (!isAuthed(event)) return { statusCode: 401, body: 'Unauthorized' };

  const { store: storeName, id } = event.queryStringParameters || {};
  if (!['pending', 'approved'].includes(storeName) || !id) {
    return { statusCode: 400, body: 'Invalid store/id' };
  }

  const store = sheetsStore();
  const photoBytes = await store.get(`${storeName}/${id}.jpg`, { type: 'arrayBuffer' });
  if (!photoBytes) return { statusCode: 404, body: 'Photo not found' };

  return {
    statusCode: 200,
    headers: { 'content-type': 'image/jpeg' },
    body: Buffer.from(photoBytes).toString('base64'),
    isBase64Encoded: true,
  };
};
