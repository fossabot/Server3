export const rooms: any = {
    KLH: 'klH',
    GRH: 'grH',
    SB: 'schH',
    PC1: 'PC1',
    223: 'PC1',
    PC2: 'PC2',
    528: 'PC2',
    KU1: 'Ku1',
    KU2: 'Ku2',
    AULA: 'Aul',
    AUL: 'Aul'
};

export const getRoom = (name: string) => {
    if (name === undefined) return undefined;
    name = name.trim().toUpperCase();
    if (/^([ABCD])$/m.test(name)) {
        return name;
    }
    if (rooms[name] === undefined) {
        if (name !== '' && !/^\d+$/.test(name)) {
            console.log(`Unknown room ${name}`);
        }
        return name;
    }
    return rooms[name];
};
