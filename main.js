const Apify = require('apify');
const request = require('request-promise');
const moment = require('moment');
const Handlebars = require('handlebars');
// Include format number helpers for handlebars
const NumeralHelper = require("handlebars.numeral");
NumeralHelper.registerHelpers(Handlebars);

const htmlTemplate = `
<!DOCTYPE html>
<html lang="en"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <meta name="description" content="">
  <meta name="author" content="">
  <link rel="icon" href="http://getbootstrap.com/favicon.ico">
  <title>Crawlers stats</title>
  <!-- Bootstrap core CSS -->
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0-beta/css/bootstrap.min.css" integrity="sha384-/Y6pD6FV/Vv2HJnA6t+vslU6fwYXjCFtcEpHbNJ0lyAFsXTsjBbfaDjzALeQsN6M" crossorigin="anonymous">
  <script src="https://code.jquery.com/jquery-3.2.1.slim.min.js" integrity="sha384-KJ3o2DKtIkvYIK3UENzmM7KCkRr/rE9/Qpg6aAZGJwFDMVNA/GpGFF93hXpG5KkN" crossorigin="anonymous"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.11.0/umd/popper.min.js" integrity="sha384-b/U6ypiBEHpOf/4+1nzFpr53nxSS+GLCkfwBdFNTxtclqqenISfwAzpKaMNFNmj4" crossorigin="anonymous"></script>
  <script src="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0-beta/js/bootstrap.min.js" integrity="sha384-h0AbiXch4ZDo7tp9hKZ4TsHbi047NrKGLO3SEJAg45jXxnGIfYzk4Si90RDIqNm1" crossorigin="anonymous"></script>
</head>
<body>
<div class="container">
  <h1>Crawlers stats</h1>
  <p class="lead">Period: {{from}} - {{to}}</p>
  <div>
    <table class="table table-bordered">
      <tbody>
      <tr>
        <td>Crawlers</td>
        <td>{{number crawlersCount}}</td>
      </tr>
      <tr>
        <td>Executions</td>
        <td>{{number executionsCount}}</td>
      </tr>
      <tr>
        <td>Crawled Pages</td>
        <td>{{number stats.pagesCrawled}}</td>
      </tr>
      <tr>
        <td>Pages Failed</td>
        <td>{{number stats.pagesFailed}}</td>
      </tr>
      <tr>
        <td>Pages Crashed</td>
        <td>{{number stats.pagesCrashed}}</td>
      </tr>
      </tbody>
    </table>
  </div>
  <h2>By crawler</h2>
  <div>
    <table class="table table-bordered">
      <thead>
      <tr>
        <th>CustomId</th>
        <th>Executions</th>
        <th>Crawled Pages</th>
        <th>Pages Failed</th>
        <th>Pages Crashed</th>
        <th></th>
      </tr>
      </thead>
      <tbody>
      {{#each crawlers}}
      <tr>
        <td><b>{{customId}}</b></td>
        <td>{{number executions.total}}</td>
        <td>{{number stats.pagesCrawled}}</td>
        <td>{{number stats.pagesFailed}}</td>
        <td>{{number stats.pagesCrashed}}</td>
        <td><button type="button" class="btn btn-outline-primary" data-toggle="collapse" data-target=".collapse_row_{{@index}}">Tags</button></td>
      </tr>
      {{#each crawlersByTagStats}}
      <tr class="collapse collapse_row_{{@../index}}">
        <td>tag: {{tag}}</td>
        <td>{{number executionsCount}}</td>
        <td>{{number stats.pagesCrawled}}</td>
        <td>{{number stats.pagesFailed}}</td>
        <td>{{number stats.pagesCrashed}}</td>
        <td></td>
      </tr>
      {{/each}}
      {{/each}}
      </tbody>
    </table>
  </div>
</div> <!-- /container -->
</body></html>
`;

const PERIODS = ['day', 'isoWeek', 'month'];

const createFilename = (period, from, to) => {
    let filename = `${period}_${moment(from).year()}`;
    if (['day', 'isoWeek', 'month'].includes(period)) filename += `_${moment(from).month() + 1}`;
    if (period === 'isoWeek') filename += `_${moment(from).date() + 1}-${moment(to).date() + 1}`;
    if (period === 'day') filename += `_${moment(from).date() + 1}`;
    return filename;
};

Apify.main(async () => {
    // Get input of your act
    const input = await Apify.getValue('INPUT');
    console.dir(input);

    if (!PERIODS.includes(input.period)) {
        console.log(`Invalide period. Uses only: ${PERIODS}`);
        return;
    }

    const storeId = input.storeId || Apify.getEnv().defaultKeyValueStoreId;
    const store = await Apify.client.keyValueStores.getStore({ storeId });
    if (!store) {
        console.log(`Key Value store doesn't exist storeId: ${storeId}`);
        return;
    }

    const issueDate = input.date || new Date();
    const FROM = moment(issueDate).startOf(input.period);
    const TO = moment(issueDate).endOf(input.period);
    const filename = createFilename(input.period, FROM, TO);
    const STATS_TOTAL = {
        from: FROM.toDate(),
        to: TO.toDate(),
        stats: {},
        executionsCount: 0,
        crawlersCount: 0,
        crawlersStats: {}
    };

    // Get all crawlers
    const crawlers = await Apify.client.crawlers.listCrawlers({});
    for (let crawler of crawlers.items) {
        const crawlerId = crawler._id;
        const crawlerStats = {
            customId: crawler.customId,
            stats: {},
            statsByTag: {},
            executions: {
                total: 0,
            },
        };

        // Aggregate stats for all executions
        let limit = 1000;
        let offset = 0;
        while (true) {
            const executions = await Apify.client.crawlers.getListOfExecutions({ crawlerId, limit, offset, desc: 1 });
            console.log(`Aggregate executions from crawler ${crawlerStats.customId}, offset: ${offset}, limit: ${limit}, count: ${executions.count}`);
            let olderExecutionsCount = 0;
            for (let execution of executions.items) {
                // Check if execution finished in requested period
                if (moment(execution.finishedAt).isBetween(FROM, TO)) {
                    const tag = execution.tag || 'no_tag';
                    if (!crawlerStats.statsByTag[tag]) crawlerStats.statsByTag[tag] = {
                        stats: {},
                        executionsCount: 0,
                    };
                    Object.keys(execution.stats).forEach((key) => {
                        STATS_TOTAL.stats[key] = STATS_TOTAL.stats[key] ? STATS_TOTAL.stats[key] + execution.stats[key] : execution.stats[key];
                        crawlerStats.stats[key] = crawlerStats.stats[key] ? crawlerStats.stats[key] + execution.stats[key] : execution.stats[key];
                        crawlerStats.statsByTag[tag].stats[key] = crawlerStats.statsByTag[tag].stats[key] ? crawlerStats.statsByTag[tag].stats[key] + execution.stats[key] : execution.stats[key];
                    });
                    crawlerStats.executions.total++;
                    crawlerStats.statsByTag[tag].executionsCount++;
                    STATS_TOTAL.executionsCount++;
                    if (crawlerStats.executions[execution.status.toLowerCase()]) {
                        crawlerStats.executions[execution.status.toLowerCase()]++;
                    } else {
                        crawlerStats.executions[execution.status.toLowerCase()] = 1;
                    }
                } else if (moment(execution.finishedAt).isBefore(FROM)) {
                    olderExecutionsCount++;
                }
            }
            if (olderExecutionsCount >= parseInt(executions.count) || parseInt(executions.count) === 0) break;
            offset = offset + limit;
            // Sleep - avoid rate limit errors
            await new Promise((resolve, reject) => setTimeout(resolve, 100));
        }

        if (crawlerStats.executions.total) {
            STATS_TOTAL.crawlersCount++;
            STATS_TOTAL.crawlersStats[crawlerId] = crawlerStats;
        }
    }

    // Save stats to key value store
    await Apify.client.keyValueStores.putRecord({ storeId, key: `${filename}_data`, body: JSON.stringify(STATS_TOTAL), contentType: 'application/json; charset=utf-8' });

    // Generate HTML page with stats
    const htmlContext = {
        from: moment(STATS_TOTAL.from).format('YYYY-MM-DD'),
        to: moment(STATS_TOTAL.to).format('YYYY-MM-DD'),
        stats: STATS_TOTAL.stats,
        executionsCount: STATS_TOTAL.executionsCount,
        crawlersCount: STATS_TOTAL.crawlersCount,
        crawlers: Object.values(STATS_TOTAL.crawlersStats),
    };
    htmlContext.crawlers.map((crawler) => {
        crawler.crawlersByTagStats = [];
        Object.keys(crawler.statsByTag).forEach((tag) => {
            const stats = Object.assign(crawler.statsByTag[tag], {tag} );
            crawler.crawlersByTagStats.push(stats);
        });
        delete crawler.statsByTag;
        return crawler;
    });
    // Sort by crawledPages
    htmlContext.crawlers.sort((a, b) =>  b.stats.pagesCrawled - a.stats.pagesCrawled);
    const template = Handlebars.compile(htmlTemplate);
    const html = template(htmlContext);
    await Apify.client.keyValueStores.putRecord({ storeId, key: `${filename}.html`, body: html, contentType: 'text/html' });
    console.log(`Done, stats were uploaded key value storeId: ${storeId}`);
});
