import http from 'http';
import https from 'https';
import { URL } from 'url';

const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100
});

const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100
});

export const keepAliveAgent = (parsedUrl: URL): http.Agent => {
  return parsedUrl.protocol === 'http:' ? httpKeepAliveAgent : httpsKeepAliveAgent;
};
