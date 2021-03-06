import config from '../config';
import request from 'request';
import {parse} from 'node-html-parser';
import entities from 'entities';
import path from 'path';
import fs from 'fs';

const cli: boolean = module.parent === null;

const isNew = (data: any) => {
    let file = path.resolve(process.cwd(), 'out', 'cafetoria', 'date.txt');
    let old = '';
    if (fs.existsSync(file)) {
        old = fs.readFileSync(file, 'utf-8').toString();
    }
    let n = data.querySelector('.MPDatum').childNodes[0].childNodes[0].rawText;
    if (old !== n) {
        fs.writeFileSync(file, n);
        return true;
    }
    return false;
};

export const fetchData = async (id: string, pin: string) => {
    return new Promise((resolve, reject) => {
        const cookieJar = request.jar();
        request.get({
            url: 'https://www.opc-asp.de/vs-aachen/',
            jar: cookieJar
        }, () => {
            request.post({
                url: 'https://www.opc-asp.de/vs-aachen/?LogIn=true',
                jar: cookieJar,
                form: {
                    sessiontest: (<any>cookieJar)._jar.store.idx['www.opc-asp.de']['/'].PHPSESSID.toString().split(';')[0].split('=')[1],
                    f_kartennr: id,
                    f_pw: pin
                }
            }, () => {
                request.get({
                    url: 'https://www.opc-asp.de/vs-aachen/menuplan.php?KID=' + id,
                    jar: cookieJar
                }, (error, response, body) => {
                    if (response.statusCode !== 200) {
                        reject({
                            error: 'Invalid credentials'
                        });
                        return;
                    }
                    resolve(body);
                });
            });
        });
    });
};

export const parseData = async (raw: string) => {
    return await parse(raw);
};

export const extractData = async (data: any) => {
    let saldo: any = parseFloat(data.querySelector('#saldoOld').childNodes[0].rawText.replace(',', '.'));
    if (cli) {
        saldo = null;
    }
    let dates = data.querySelectorAll('.MPDatum');
    dates = dates.map((a: any) => a.childNodes).map((b: any) => {
        return {weekday: b[2].rawText, date: b[0].childNodes[0].rawText};
    });
    const names = data.querySelectorAll('.angebot_text');
    const prices = data.querySelectorAll('.angebot_preis');
    return {
        saldo,
        error: null, days: dates.map((date: any) => {
            let menues: any = [];
            for (let i = 0; i < 4; i++) {
                let text = entities.decodeHTML(names[dates.indexOf(date) * 4 + i].childNodes.length >= 1 ? names[dates.indexOf(date) * 4 + i].childNodes.map((a: any) => a.rawText).join(' ').replace('  ', ' ') : '');
                let time = '';
                if (text.includes(' Uhr ')) {
                    time = text.split(' Uhr ')[0];
                    text = text.split(' Uhr ')[1];
                    time = time.replace(/\./g, ':');
                    let timeS = time.split(' - ')[0] || '';
                    let timeE = time.split(' - ')[1] || '';
                    if (timeS !== '') {
                        if (!timeS.includes(':')) {
                            timeS += ':00';
                        }
                    }
                    if (timeE !== '') {
                        if (!timeE.includes(':')) {
                            timeE += ':00';
                        }
                    }
                    time = timeS + (timeE !== '' ? ' - ' + timeE : '') + ' Uhr';
                }
                menues.push({
                    name: text,
                    time: time,
                    price: prices[dates.indexOf(date) * 4 + i].childNodes.length == 1 ? parseFloat(prices[dates.indexOf(date) * 4 + i].childNodes[0].rawText.replace('&euro;', '').trim().replace(',', '.')) : 0
                });
            }
            menues = menues.filter((a: any) => a.name !== '');
            return {
                date: date.date,
                weekday: date.weekday,
                menues
            };
        })
    };
};

export const fetchDataForUser = async (id: string, pin: string) => {
    if (id === '' && pin === '') {
        return await JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'out', 'cafetoria', 'list.json'), 'utf-8'));
    } else {
        return new Promise((resolve, reject) => {
            fetchData(id, pin).then((raw: any) => {
                parseData(raw).then((data: any) => {
                    extractData(data).then((menues: any) => {
                        resolve(menues);
                    });
                });
            }).catch(reject);
        });
    }
};

if (module.parent === null) {
    (async () => {
        fetchData(config.cafetoriaId, config.cafetoriaPin).then((raw: any) => {
            console.log('Fetched menues');
            parseData(raw).then((data: any) => {
                console.log('Parsed menues');
                if (isNew(data)) {
                    extractData(data).then((menues: any) => {
                        console.log('Extracted menues');
                        fs.writeFileSync(path.resolve(process.cwd(), 'out', 'cafetoria', 'list.json'), JSON.stringify(menues, null, 2));
                        console.log('Saved menues');
                    });
                }
            });
        }).catch(() => {
            console.log('Wrong Cafetoria credentials');
        });
    })();
}
