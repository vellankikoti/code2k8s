/** @type {import('next').NextConfig} */
export default {
  async rewrites() {
    const api = process.env.API_URL ?? "http://localhost:8080";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};
