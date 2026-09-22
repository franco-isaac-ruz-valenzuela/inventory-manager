const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@ericblade/quagga2': path.resolve(__dirname, 'node_modules/@ericblade/quagga2/dist/quagga.min.js'),
    };
    return config;
  },
};

module.exports = nextConfig;
