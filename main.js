const Apify = require('apify');
const moment = require('moment');
const Handlebars = require('handlebars');
const fs = require('fs');
// Include format number helpers for handlebars
const NumeralHelper = require("handlebars.numeral");
NumeralHelper.registerHelpers(Handlebars);

const htmlTemplate = fs.readFileSync('./template.html', 'utf8');

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

    let issueDate = input.date || new Date();
    if (input.finishedPeriod) {
        const [number, period] = (input.period === 'isoWeek') ? [1, 'week'] : [1, input.period];
        issueDate = moment(issueDate).subtract(number, period);
    }
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

    console.log(`Aggregates stats from ${moment(FROM).format('YYYY-MM-DD')} to ${moment(TO).format('YYYY-MM-DD')}`);

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
    await Apify.setValue('OUTPUT', {
        htmlStatsUrl: `https://api.apify.com/v2/key-value-stores/${storeId}/records/${filename}.html?rawBody=1`,
        statsUrl: `https://api.apify.com/v2/key-value-stores/${storeId}/records/${filename}_data?rawBody=1`,
        from: htmlContext.from,
        to: htmlContext.to
    });
    console.log(`Done, stats were uploaded key value storeId: ${storeId}`);
});
