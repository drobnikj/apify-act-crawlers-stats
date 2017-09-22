const Apify = require('apify');
const request = require('request-promise');
const moment = require('moment');
const Handlebars = require('handlebars');

const PERIODS = ['week', 'month'];

const htmlTemplate = `
<!DOCTYPE html>
<html lang="en"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="">
    <meta name="author" content="">
    <link rel="icon" href="http://getbootstrap.com/favicon.ico">
    <title>Crawlers stats</title>
    <!-- Bootstrap core CSS -->
    <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0-beta/css/bootstrap.min.css" integrity="sha384-/Y6pD6FV/Vv2HJnA6t+vslU6fwYXjCFtcEpHbNJ0lyAFsXTsjBbfaDjzALeQsN6M" crossorigin="anonymous">
</head>
<body>
<div class="container">
    <h1>Crawlers stats</h1>
    <p class="lead">Period: {{from}} - {{to}}</p>
    <h2>All</h2>
    <div>
        <table class="table table-bordered">
            <thead>
            <tr>
                <th>CustomId</th>
                <th>Executions</th>
                <th>Crawled Pages</th>
                <th>Pages Failed</th>
                <th>Pages Crashed</th>
            </tr>
            </thead>
            <tbody>
            {{#each crawlers}}
            <tr>
                <td>{{customId}}</td>
                <td>{{executions.total}}</td>
                <td>{{stats.pagesCrawled}}</td>
                <td>{{stats.pagesFailed}}</td>
                <td>{{stats.pagesCrashed}}</td>
            </tr>
            {{/each}}
            </tbody>
        </table>
    </div>
    <h2>By Tag</h2>
    <div>
        <table class="table table-bordered">
            <thead>
            <tr>
                <th>CustomId</th>
                <th>Executions</th>
                <th>Crawled Pages</th>
                <th>Pages Failed</th>
                <th>Pages Crashed</th>
            </tr>
            </thead>
            <tbody>
            {{#each crawlersByTag}}
            <tr>
                <td>{{customId}} - {{tag}}</td>
                <td>{{data.executionsCount}}</td>
                <td>{{data.stats.pagesCrawled}}</td>
                <td>{{data.stats.pagesFailed}}</td>
                <td>{{data.stats.pagesCrashed}}</td>
            </tr>
            {{/each}}
            </tbody>
        </table>
    </div>
</div> <!-- /container -->
<script src="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0-beta/js/bootstrap.min.js" integrity="sha384-h0AbiXch4ZDo7tp9hKZ4TsHbi047NrKGLO3SEJAg45jXxnGIfYzk4Si90RDIqNm1" crossorigin="anonymous"></script>
<script src="https://code.jquery.com/jquery-3.2.1.slim.min.js" integrity="sha384-KJ3o2DKtIkvYIK3UENzmM7KCkRr/rE9/Qpg6aAZGJwFDMVNA/GpGFF93hXpG5KkN" crossorigin="anonymous"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.11.0/umd/popper.min.js" integrity="sha384-b/U6ypiBEHpOf/4+1nzFpr53nxSS+GLCkfwBdFNTxtclqqenISfwAzpKaMNFNmj4" crossorigin="anonymous"></script>
</body></html>
`;

const createFilename = (period, from, to) => {
    let filename = `${period}_${from.year()}`;
    if (['week', 'month'].includes(period)) filename += `_${from.month() + 1}`;
    if (period === 'week') filename += `_${from.date() + 1}-${to.date() + 1}`;
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

    const FROM = moment().startOf(input.period);
    const TO = moment().endOf(input.period);
    const STATS = {};
    const filename = createFilename(input.period, FROM, TO);


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
        let breakLoop = false;
        while (true) {
            const executions = await Apify.client.crawlers.getListOfExecutions({ crawlerId, limit, offset });
            console.log(`Aggregate executions from crawler ${crawlerStats.customId}, offset: ${offset}, limit: ${limit}`);
            for (let execution of executions.items) {
                // Check if execution finished in requested period
                if (moment(execution.finishedAt).isBetween(FROM, TO)) {
                    const tag = execution.tag || 'no_tag';
                    if (!crawlerStats.statsByTag[tag]) crawlerStats.statsByTag[tag] = {
                        stats: {},
                        executionsCount: 0,
                    };
                    Object.keys(execution.stats).forEach((key) => {
                        crawlerStats.stats[key] = crawlerStats.stats[key] ? crawlerStats.stats[key] + execution.stats[key] : execution.stats[key];
                        crawlerStats.statsByTag[tag].stats[key] = crawlerStats.statsByTag[tag].stats[key] ? crawlerStats.statsByTag[tag].stats[key] + execution.stats[key] : execution.stats[key];
                    });
                    crawlerStats.executions.total++;
                    crawlerStats.statsByTag[tag].executionsCount++;
                    if (crawlerStats.executions[execution.status.toLowerCase()]) {
                        crawlerStats.executions[execution.status.toLowerCase()]++;
                    } else {
                        crawlerStats.executions[execution.status.toLowerCase()] = 1;
                    }
                } else {
                    breakLoop = true;
                }
            }
            if ((executions.count + executions.offset) >= executions.total || breakLoop || executions.count === 0) break;
            offset = offset + limit;
        }

        if (crawlerStats.executions.total) STATS[crawlerId] = crawlerStats;
    }

    // Generate HTML page with stats
    const htmlContext = {
        from: FROM.format('YYYY-MM-DD'),
        to: TO.format('YYYY-MM-DD'),
        crawlers: Object.values(STATS),
        crawlersByTag: [],
    };
    htmlContext.crawlers.map((crawler) => {
        Object.keys(crawler.statsByTag).forEach((tag) => {
            crawler.tag = tag;
            crawler.data = crawler.statsByTag[tag];
            htmlContext.crawlersByTag.push(crawler);
        });
    });
    const template = Handlebars.compile(htmlTemplate);
    const html = template(htmlContext);
    // Save stats to key value store
    await Apify.setValue(`${filename}_data`, STATS, { storeId });
    await Apify.setValue(`${filename}.html`, html, { storeId, contentType: 'text/html' });
    console.log(`Done, stats were uploaded key value store`);
});
