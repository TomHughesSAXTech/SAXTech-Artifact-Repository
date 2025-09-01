const { BlobServiceClient } = require('@azure/storage-blob');
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

module.exports = async function (context, req) {
    try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerClient = blobServiceClient.getContainerClient('fcs-clients');

        const listBlobsResponse = await containerClient.listBlobsByHierarchy('/');
        const blobs = [];

        for await (const item of listBlobsResponse) {
            // Only process blob items, not directories
            if (item.kind === 'blob') {
                blobs.push({
                    name: item.name,
                    contentLength: item.properties.contentLength,
                    lastModified: item.properties.lastModified
                });
            }
        }

        context.res = {
            status: 200,
            body: blobs,
            headers: {
                'Access-Control-Allow-Origin': '*'
            }
        };
    } catch (error) {
        context.log('Error:', error);
        context.res = {
            status: 500,
            body: { error: 'Failed to list blobs' },
            headers: {
                'Access-Control-Allow-Origin': '*'
            }
        };
    }
};
