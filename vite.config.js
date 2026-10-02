import {defineConfig, loadEnv} from 'vite';
import {resolve} from 'node:path';
import fs from 'node:fs/promises';

export default defineConfig(({command,mode})=>{
  const env=loadEnv(mode,process.cwd(),'');
  const backendTarget=env.VITE_API_PROXY_TARGET||`http://127.0.0.1:${env.PORT||3000}`;
  const configuredSiteUrl=(env.VITE_SITE_URL||'').replace(/\/+$/,'');
  const siteUrl=command==='serve'?(configuredSiteUrl||'http://localhost:5173'):configuredSiteUrl;
  if(command==='build'&&!siteUrl) throw new Error('VITE_SITE_URL is required; set it to the public site URL before building.');
  const allowInsecure=env.ALLOW_INSECURE_SITE_URL_BUILD||process.env.ALLOW_INSECURE_SITE_URL_BUILD;
  if(command==='build'&&allowInsecure!=='true'&&!/^https:\/\//i.test(siteUrl)) throw new Error('VITE_SITE_URL must start with https:// for production builds.');
  const turnstileEnabled=Boolean(env.VITE_TURNSTILE_SITE_KEY);
  return {
  root: 'client',
  publicDir: 'public',
  plugins:[{
    name:'site-environment',
    transformIndexHtml(html){
      let output=html.replaceAll('%SITE_URL%',siteUrl);
      if(turnstileEnabled){
        output=output.replaceAll("script-src 'self'", "script-src 'self' https://challenges.cloudflare.com")
          .replaceAll('frame-src https://www.google.com', 'frame-src https://www.google.com https://challenges.cloudflare.com')
          .replaceAll("connect-src 'self'", "connect-src 'self' https://challenges.cloudflare.com");
      }
      return output;
    },
    async closeBundle(){
      for(const file of ['robots.txt','sitemap.xml']){
        const filePath=resolve(process.cwd(),'client/dist',file);
        try{const source=await fs.readFile(filePath,'utf8');await fs.writeFile(filePath,source.replaceAll('%SITE_URL%',siteUrl));}catch{}
      }
      const notFoundPath=resolve(process.cwd(),'client/dist/404.html');
      const notFoundHtml=await fs.readFile(notFoundPath,'utf8');
      await fs.writeFile(notFoundPath,notFoundHtml.replace(/(<link\b[^>]*rel="stylesheet")\s+crossorigin(?=[\s>])/i,'$1'));
    }
  }],
  server: {
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true
      },
      '/uploads': {
        target: backendTarget,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: resolve(process.cwd(),'client/dist'),
    emptyOutDir: true,
    target: 'es2022',
    cssMinify: true,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: resolve(process.cwd(),'client/index.html'),
        admin: resolve(process.cwd(),'client/admin.html'),
        notFound: resolve(process.cwd(),'client/404.html')
      }
    }
  }
  };
});
