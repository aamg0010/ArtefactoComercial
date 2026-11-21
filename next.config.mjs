/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  // Red de seguridad: si el servidor web pide /index.html (DirectoryIndex), se lleva a la portada.
  async redirects() { return [{ source: '/index.html', destination: '/', permanent: false }]; },
};
export default nextConfig;
