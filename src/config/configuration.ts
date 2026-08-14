export type AppConfig = ReturnType<typeof configuration>;

export const configuration = () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  appUrl: process.env.APP_URL as string,
  storefrontUrl: process.env.STOREFRONT_URL as string,
  adminUrl: process.env.ADMIN_URL as string,

  database: {
    url: process.env.DATABASE_URL as string,
  },

  redis: {
    url: process.env.REDIS_URL as string,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET as string,
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL ?? '',
    get isConfigured() {
      return Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      );
    },
  },

  mail: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.MAIL_FROM ?? 'onboarding@resend.dev',
    replyTo: process.env.MAIL_REPLY_TO ?? '',
  },

  media: {
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
      apiKey: process.env.CLOUDINARY_API_KEY ?? '',
      apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
      folder: process.env.CLOUDINARY_FOLDER ?? 'boutique',
    },
  },

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
  },

  // Vides en production tant que non configurés : Swagger reste alors
  // désactivé plutôt que de s'exposer sans protection par défaut.
  swagger: {
    user: process.env.SWAGGER_USER ?? '',
    password: process.env.SWAGGER_PASSWORD ?? '',
  },
});

export default configuration;
