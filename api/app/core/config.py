from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables or .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "NetAtlas API"
    app_version: str = "0.1.0"
    mock_mode: bool = True

    netdisco_db_host: str = "netdisco-postgresql"
    netdisco_db_port: int = 5432
    netdisco_db_name: str = "netdisco"
    netdisco_db_user: str = "netdisco"
    netdisco_db_pass: str = "netatlas_dev_password"

    cors_origins: str = "http://localhost:5173,http://localhost:8080,http://localhost"

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [item.strip() for item in self.cors_origins.split(",") if item.strip()]
        return origins or ["*"]


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings instance."""
    return Settings()


settings = get_settings()
