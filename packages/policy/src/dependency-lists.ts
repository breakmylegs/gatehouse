/**
 * D-053: the lists bundled with Codehouse for dependency admission. No network is used: a name is judged against the
 * project's own lockfiles and manifests, the owner's approved list, and these.
 */

export type Ecosystem = "npm" | "pypi" | "nuget" | "cargo" | "go"

/** Widely used packages per ecosystem, for telling a near miss ("lodahs") from a new name. */
export const POPULAR: Record<Ecosystem, readonly string[]> = {
  npm: [
    "react", "react-dom", "lodash", "express", "axios", "chalk", "commander", "debug", "moment", "dayjs",
    "typescript", "webpack", "vite", "esbuild", "rollup", "eslint", "prettier", "jest", "vitest", "mocha",
    "vue", "next", "nuxt", "svelte", "angular", "rxjs", "uuid", "dotenv", "zod", "yup", "classnames", "clsx",
    "redux", "react-redux", "zustand", "mobx", "graphql", "apollo-server", "socket.io", "ws", "cors",
    "body-parser", "cookie-parser", "jsonwebtoken", "bcrypt", "bcryptjs", "mongoose", "sequelize", "prisma",
    "pg", "mysql2", "sqlite3", "redis", "ioredis", "node-fetch", "cross-env", "nodemon", "ts-node", "tsx",
    "tailwindcss", "postcss", "autoprefixer", "sass", "styled-components", "emotion", "framer-motion",
    "date-fns", "luxon", "ramda", "immer", "yargs", "inquirer", "ora", "glob", "rimraf", "fs-extra",
    "semver", "minimist", "qs", "request", "underscore", "jquery", "bootstrap", "three", "d3", "chart.js",
    "fastify", "koa", "hapi", "nestjs", "puppeteer", "playwright", "cheerio", "sharp", "multer", "passport",
  ],
  pypi: [
    "requests", "numpy", "pandas", "scipy", "matplotlib", "seaborn", "scikit-learn", "tensorflow", "torch",
    "keras", "flask", "django", "fastapi", "uvicorn", "pydantic", "sqlalchemy", "alembic", "psycopg2",
    "boto3", "botocore", "pytest", "black", "flake8", "mypy", "isort", "ruff", "pylint", "click", "typer",
    "rich", "httpx", "aiohttp", "beautifulsoup4", "lxml", "pillow", "opencv-python", "jinja2", "pyyaml",
    "toml", "python-dotenv", "celery", "redis", "pymongo", "transformers", "huggingface-hub", "openai",
    "anthropic", "langchain", "tqdm", "setuptools", "wheel", "pip", "virtualenv", "poetry", "attrs",
    "cryptography", "paramiko", "selenium", "scrapy", "networkx", "sympy", "plotly", "dash", "streamlit",
    "gunicorn", "werkzeug", "marshmallow", "arrow", "pendulum", "six", "urllib3", "certifi", "idna",
  ],
  nuget: [
    "Newtonsoft.Json", "Serilog", "NLog", "AutoMapper", "Dapper", "EntityFramework",
    "Microsoft.EntityFrameworkCore", "xunit", "NUnit", "Moq", "FluentAssertions", "Polly", "MediatR",
    "Swashbuckle.AspNetCore", "RestSharp", "System.Text.Json", "CsvHelper", "Humanizer", "FluentValidation",
  ],
  cargo: [
    "serde", "serde_json", "tokio", "rand", "clap", "anyhow", "thiserror", "regex", "reqwest", "log",
    "env_logger", "chrono", "lazy_static", "once_cell", "itertools", "futures", "hyper", "axum", "tracing",
  ],
  go: [
    "github.com/gin-gonic/gin", "github.com/gorilla/mux", "github.com/spf13/cobra", "github.com/stretchr/testify",
    "github.com/sirupsen/logrus", "go.uber.org/zap", "github.com/google/uuid", "golang.org/x/net",
  ],
}

/**
 * Names that language models have been found to invent, shared across models, and that a squatter could register.
 * Each with where it was reported and when. A name here that the project does not already use is denied.
 *
 * The 2026 study behind D-053 (arXiv 2605.17062, R15 in the research paper) counted 127 shared names but its text as
 * held here does not list them, so they are not copied in; the owner adds names here as they are published.
 */
export const KNOWN_HALLUCINATIONS: ReadonlyArray<{ ecosystem: Ecosystem; name: string; source: string; date: string }> = [
  {
    ecosystem: "pypi",
    name: "huggingface-cli",
    source: "Lasso Security (Bar Lanyado), research on AI package hallucinations: a name models invented, registered as a proof of concept",
    date: "2024-03",
  },
]
