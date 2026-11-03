/** @type {import('next').NextConfig} */
const nextConfig = {
  // صورة صغيرة للإنتاج: Docker بياخد مجلد standalone بس
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
