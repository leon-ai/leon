# Trend Package

The trend package contains modules related to trends.

## Modules

### GitHub

Grab the GitHub trends repositories according to several options.

#### Usage

```
(en-US) "What's trending on GitHub?"
(en-US) "Give me the 4 GitHub trends of this week for the JavaScript language"
(en-US) "What's the three GitHub trends of this month?"
(fr-FR) "Quelles sont les tendances sur GitHub ?"
(fr-FR) "Donne-moi les 4 tendances GitHub de cette semaine pour le langage JavaScript"
(fr-FR) "Donne-moi les trois tendances GitHub de ce mois"
...
```

### Product Hunt

Grab the Product Hunt trends products

#### Usage

1. Log in to your [Product Hunt](https://www.producthunt.com/) account.
2. Add a [new application](https://www.producthunt.com/v1/oauth/applications) (E.g. name: Leon; Redirect URI: https://localhost).
3. Once your application is created, click `Create Token`.
4. Copy the `Developer Token` and paste it in `packages/trend/config/config.json` at the `producthunt.developer_token` key.

```
(en-US) "What's trending on Product Hunt?"
(en-US) "What were the four first Product Hunt trends on the 7th of October 2018?"
(en-US) "What were the Product Hunt trends of yesterday?"
(fr-FR) "Quelles sont les tendances sur Product Hunt ?"
(fr-FR) "Donne-moi les 4 tendances Product Hunt du 7 octobre 2018"
...
```
