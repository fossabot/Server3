import fs from 'fs';
import path from 'path';
import config from '../config';
import got from 'got';
import {parse} from 'node-html-parser';
import {saveNewUnitplan} from '../history/history';
import {getInjectedUnitplan} from "../replacementplan/connectWithUnitplan";
import {getUsers} from '../tags/users';
import {updateApp} from '../update_app';
import {getRoom} from '../rooms';
import {getSubject} from '../subjects';
import {initFirebase} from '../firebase';
import {sendNotification} from '../notification';

const isDev = process.argv.length === 3;
const untiPlanPath = process.argv.length === 4 ? process.argv[3] : undefined;
const grades = ['5a', '5b', '5c', '6a', '6b', '6c', '7a', '7b', '7c', '8a', '8b', '8c', '9a', '9b', '9c', 'EF', 'Q1', 'Q2'];
const weekdays = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];

const isNew = (data: any) => {
    let file = path.resolve(process.cwd(), 'out', 'unitplan', 'date.txt');
    let old = '';
    if (fs.existsSync(file)) {
        old = fs.readFileSync(file, 'utf-8').toString();
    }
    let n = data.querySelectorAll('div')[0].childNodes[0].rawText;
    if (old !== n) {
        fs.writeFileSync(file, n);
        return true;
    }
    return false;
};

const fetchData = async (weekA = true) => {
    const week = weekA ? 'A.html' : 'B.html';
    let path = untiPlanPath || `https://www.viktoriaschule-aachen.de/sundvplan/sps/${weekA ? 'left' : 'right'}.html`;
    if (untiPlanPath !== undefined) path = path.replace('.html', week);
    if (path.startsWith('http')) return (await got(path, {auth: config.username + ':' + config.password})).body;
    else return fs.readFileSync(path, 'utf-8').toString();
};

const parseData = async (raw: string) => {
    return await parse(raw);
};

const extractData = async (data: any) => {
    return await grades.map(grade => {
        let d: any = weekdays.map((weekday: string) => {
            return {
                weekday: weekday,
                replacementplan: {
                    for: {
                        date: '',
                        weekday: '',
                        weektype: ''
                    },
                    updated: {
                        date: '',
                        time: ''
                    }
                },
                lessons: {}
            };
        });
        data.querySelectorAll('table')[grades.indexOf(grade)].childNodes.slice(1).forEach((row: any, unit: number) => {
            row.childNodes.slice(1).forEach((field: any, day: number) => {
                const a: any = field.childNodes.map((a: any) => a.childNodes[0].rawText.trim().replace(/ +(?= )/g, '')).filter((a: string, i: number) => a != '' || i == 5);
                if (a.length > 0) {
                    if (d[day].lessons[unit] === undefined && !(a.length === 1 && a[0].includes('*'))) {
                        d[day].lessons[unit] = [];
                    }
                    if (a.length === 1 && !a[0].includes('*')) {
                        d[day].lessons[unit].push({
                            block: '',
                            participant: a[0].split(' ')[0],
                            subject: getSubject(a[0].split(' ')[1].toUpperCase().replace(/[0-9]/g, '')),
                            room: getRoom(a[0].split(' ')[2].toUpperCase()),
                            course: '',
                            changes: []
                        });
                    } else {
                        for (let i = 1; i < a.length; i++) {
                            if (a[i].split(' ').length < 3) {
                                a[i] += ' a';
                            }
                            d[day].lessons[unit].push({
                                block: a[0].split(' ')[1],
                                participant: a[i].split(' ')[1],
                                subject: getSubject(a[i].split(' ')[0].toUpperCase().replace(/[0-9]/g, '')),
                                room: getRoom(a[i].split(' ')[2].toUpperCase()),
                                course: '',
                                changes: []
                            });
                        }
                    }
                }
            });
        });
        d = d.map((a: any) => {
            if (Object.keys(a.lessons).length >= 6) {
                a.lessons['5'] = [{
                    block: '',
                    participant: '',
                    subject: 'Mittagspause',
                    room: '',
                    course: '',
                    changes: [],
                    week: 'AB'
                }];
            }
            Object.keys(a.lessons).forEach((lesson: any) => {
                if (a.lessons[lesson].length > 1 || a.lessons[lesson][0].block !== '') {
                    a.lessons[lesson].push({
                        block: a.lessons[lesson][0].block,
                        participant: '',
                        subject: 'Freistunde',
                        room: '',
                        course: '',
                        changes: [],
                        week: 'AB'
                    });
                }
            });
            return a;
        });
        d = d.map((a: any) => {
            if (grade === 'EF' || grade === 'Q1' || grade === 'Q2') {
                Object.keys(a.lessons).forEach((unit: string) => {
                    let b = a.lessons[unit];
                    const containsMultiple = b.filter((subject: any) => {
                        return /^(a|b|c|d)$/gmi.test(subject.room);
                    }).length > 0;
                    b = b.map((subject: any) => {
                        if (config.isFirstQ) {
                            if (/^(a|b|c|d)$/gmi.test(subject.room)) {
                                subject.room = '';
                                subject.participant = '';
                            }
                        } else {
                            if (containsMultiple) {
                                if (!/^(a|b|c|d)$/gmi.test(subject.room)) {
                                    subject.room = '';
                                    subject.participant = '';
                                }
                            }
                        }
                        return subject;
                    });
                    a.lessons[unit] = b;
                });
            }
            return a;
        });
        return {
            participant: grade,
            date: data.querySelector('div').childNodes[0].rawText.split(' den ')[1].trim(),
            data: d
        };
    });
};

export const sendNotifications = async (isDev: Boolean) => {
    try {
        let devices = getUsers().filter((device: any) => (!isDev || device.tags.dev) && device.tags.grade !== undefined);
        console.log('Sending notifications to ' + devices.length + ' devices');
        await sendNotification({
            devices: devices,
            group: 'unitplanChanged',
            text: 'Es einen neuen Stundenplan!',
            title: 'Stundenplan',
            data: {
                type: 'replacementplan'
            }
        });

        await updateApp('All', {
            'type': 'unitplan',
            'action': 'update'
        }, isDev);
    } catch (e) {
        console.error('Failed to send notifications', e);
    }
};

const getFreeLesson = (week: string, block: string) => {
    return {
        block: block,
        participant: '',
        subject: 'Freistunde',
        room: '',
        course: '',
        changes: [],
        week: week
    }
};

const concatWeeks = (dataA: any, dataB: any) => {
    const unitplan: any = [];
    dataA.forEach((gradeA: any, index: number) => {
        const gradeB = dataB[index];
        const grade: any = {};

        Object.keys(gradeA).forEach((key: string) => {
            if (key !== 'data') grade[key] = gradeA[key];
            else grade.data = [];
        });

        for (let i = 0; i < 5; i++) {
            grade.data.push({});
            Object.keys(gradeA.data[i]).forEach((key: string) => {
                if (key !== 'lessons') grade.data[i][key] = gradeA.data[i][key];
                else grade.data[i].lessons = {};
            });
            for (let j = 0; j < 9; j++) {
                const key = j.toString();
                let lessonA: any;
                let lessonB: any;
                const addFreeLesson = [false, false];
                if (Object.keys(gradeA.data[i].lessons).length > j) lessonA = gradeA.data[i].lessons[key];
                if (Object.keys(gradeB.data[i].lessons).length > j) lessonB = gradeB.data[i].lessons[key];

                if (lessonA === undefined && lessonB === undefined) continue;
                if (lessonA === undefined && lessonB !== undefined) {
                    grade.data[i].lessons[key] = lessonB;
                    grade.data[i].lessons[key].forEach((subject: any) => subject.week = 'B');
                    if (key !== '5') addFreeLesson[0] = true;
                } else if (lessonA !== undefined && lessonB === undefined) {
                    grade.data[i].lessons[key] = lessonA;
                    grade.data[i].lessons[key].forEach((subject: any) => subject.week = 'A');
                    if (key !== '5') addFreeLesson[1] = true;
                } else {
                    grade.data[i].lessons[key] = [];
                    const listShort = lessonA.length >= lessonB.length ? lessonB : lessonA;
                    const listLong = lessonA.length >= lessonB.length ? lessonA : lessonB;
                    for (let k = 0; k < listLong.length; k++) {
                        const subject1 = listLong[k];
                        let found = false;
                        for (let l = 0; l < listShort.length; l++) {
                            const subject2 = listShort[l];
                            if (subject1.subject === subject2.subject && subject1.participant === subject2.participant && subject1.room === subject2.room) {
                                subject1.week = 'AB';
                                grade.data[i].lessons[key].push(subject1);
                                listShort.splice(l, 1);
                                found = true;
                                break;
                            }
                        }
                        if (!found) {
                            subject1.week = lessonA.length >= lessonB.length ? 'A' : 'B';
                            addFreeLesson[subject1.week == 'B' ? 0 : 1] = true;
                            grade.data[i].lessons[key].push(subject1);
                        }
                    }
                    if (listShort.length > 0) {
                        listShort.forEach((subject: any) => {
                            subject.week = lessonA.length >= lessonB.length ? 'B' : 'A';
                            addFreeLesson[subject.week == 'B' ? 0 : 1] = true;
                            grade.data[i].lessons[key].push(subject);
                        });
                    }
                }
                addFreeLesson.forEach((j, index) => {
                    if (j) grade.data[i].lessons[key].push(getFreeLesson(index == 0 ? 'A' : 'B', grade.data[i].lessons[key][0].block));
                });
            }
        }

        unitplan.push(grade);
    });

    return unitplan;
};

(async () => {
    const rawA = await fetchData(true);
    const rawB = await fetchData(false);
    console.log('Fetched unit plan');
    const dataA = await parseData(rawA);
    const dataB = await parseData(rawB);
    console.log('Parsed unit plan');
    if (isNew(dataA) || isDev) {
        await initFirebase();
        saveNewUnitplan(rawA, rawB, []);
        const unitplanA = await extractData(dataA);
        const unitplanB = await extractData(dataB);
        const unitplan = concatWeeks(unitplanA, unitplanB);
        console.log('Extracted unit plan');
        unitplan.forEach((data: any) => {
            fs.writeFileSync(path.resolve(process.cwd(), 'out', 'unitplan', data.participant + '.json'), JSON.stringify(data, null, 2));
            try {
                fs.writeFileSync(path.resolve(process.cwd(), 'out', 'unitplan', data.participant + '.json'), JSON.stringify(getInjectedUnitplan(data.participant), null, 2))
            } catch (e) {

            }
        });
        saveNewUnitplan('', '', unitplan);
        console.log('Saved unit plan');
        sendNotifications(isDev);
    }
})();
