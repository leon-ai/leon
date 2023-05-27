# Product Hunt

Grab the Product Hunt trends.

## Usage

1. Sign in to your [Product Hunt](https://www.producthunt.com/) account.
2. Add a [new application](https://www.producthunt.com/v2/oauth/applications) (e.g. name: `Leon`; Redirect URI: `https://localhost:1337`).
3. Once your application is created, click `Create Token`.
4. Copy the `Developer Token` and paste it in `skills/news/product_hunt_trends/src/settings.json` at the `developer_token` key.

```txt
(en-US) "What's trending on Product Hunt?"

(fr-FR) "Quelles sont les tendances sur Product Hunt ?"
```
