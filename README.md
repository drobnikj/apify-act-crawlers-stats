# apify-act-crawlers-stats

Apify act aggregate stats from Apify crawlers by selected period.

## Input

Example:
```json
{
    "date": "2017-08-01",
    "period": "month",
    "storeId": "sd6Hjk68kmd8hj"
}
```

### `period`

- Required
- Selected period of aggregation
- You can use "month" or "week".

### `date`

- Optional
- You can overwrite date of aggregation by default date of aggregation is current date.

### `storeId`

- Optional
- You can set up Apify key value store, where act saves results.
- By default default act default key value store is used.

## Output

Act saves output to key value store.
There are 2 types of output:

- html page with stats
- data in JSON format