# Checker Package

The checker package contains modules which include checkings.

## Modules

### Is it Down

Ping domain names and give you the online state.

#### Usage

```
(en-US) "Are github.com, an-awesome-domain-name.net and twitter.com down?"

(fr-FR) "Vérifies si github.com, un-super-nom-de-domaine.fr et twitter.com sont en ligne"
...
```

### Have I Been Pwned

Verify if one or several email addresses have been pwned (thanks to [Have I Been Pwned](https://haveibeenpwned.com/).

#### Usage

```
(en-US) "Has louis.grenard@gmail.com been pwned?"
(en-US) "Have iifeoluwa.ao@gmail.com, louis.grenard@gmail.com, and supercleanemail@test.com been pwned?"

(fr-FR) "Est-ce que louis.grenard@gmail.com est compromis ?"
(fr-FR) "Est-ce que iifeoluwa.ao@gmail.com, louis.grenard@gmail.com, et supercleanemail@test.com ont été compromis ?"
```

You can also predefined one or several email addresses in the `packages/checker/config/config.json` file at the `haveibeenpwned.emails` key.

If you do, then you can use such sentences:

```
(en-US) "Have my email addresses been pwned?"

(fr-FR) "Est-ce que mes adresses email ont été compromises ?"
```
