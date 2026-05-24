export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME?: string;
  DEFAULT_FORM_SLUG?: string;
  ADMIN_TOKEN?: string;
  TURNSTILE_SECRET_KEY?: string;
  RATE_LIMIT_SALT?: string;
};

export type AppEnv = {
  Bindings: Bindings;
};
