const https = require("node:https");
const fetch = require("node-fetch");

class Api {

    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.session = null;
        this.endpoint = null;
        this.serial = null;
        this.token = null;
    }

    async login() {
        const res = await fetch("https://enlighten.enphaseenergy.com/login/login.json", {
            method: "POST",
            body: new URLSearchParams({
                "user[email]": this.username,
                "user[password]": this.password
            })
        });
        if (!res.ok) {
            throw new Error("Authentication failed");
        }
        const json = await res.json();
        this.session = json.session_id;
        return this;
    }

    async setEndpoint(endpoint, serial) {
        this.endpoint = `https://${endpoint}/`;
        this.serial = serial;
        await this.getToken();
    }

    async getToken() {
        if (!this.session) {
            throw new Error("No session");
        }
        if (!this.serial) {
            throw new Error("No serial number");
        }
        const res = await fetch("https://entrez.enphaseenergy.com/tokens", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: this.username,
                session_id: this.session,
                serial_num: this.serial
            })
        });
        if (!res.ok) {
            throw new Error("Failed to get access token");
        }
        this.token = await res.text();
        return this.token;
    }

    async _fetch(path) {
        let res = await fetch(`${this.endpoint}${path}`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${this.token}`
            },
            agent: https.Agent({
                rejectUnauthorized: false,
            })
        });
        if (!res.ok) {
            if (res.status >= 400 && res.status < 500) {
                // Refresh token and retry
                await this.getToken();
                res = await fetch(`${this.endpoint}${path}`, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${this.token}`
                    },
                    agent: https.Agent({
                        rejectUnauthorized: false,
                    })
                });
            }
            if (!res.ok) {
                throw Error(`Status: ${res.status}`);
            }
        }
        const json = await res.json();
        return json;
    }

    async getMeters() {
        const meters = await this._fetch("ivp/meters");
        const list = [];
        meters.forEach(m => {
            if (m.state === "enabled") {
                list.push({ eid: m.eid, type: m.measurementType });
            }
        });
        return list;
    }

    async getInverters() {
        const inv = await this._fetch("inventory.json");
        const devices = [];
        inv.forEach(item => {
            if (item.type === "PCU") {
                item.devices.forEach(dev => {
                    devices.push({
                        partNumber: dev.part_num,
                        serialNumber: dev.serial_num,
                        producing: dev.producing,
                        communicating: dev.communicating,
                        phase: dev.phase
                    });
                });
            }
        });
        return devices;
    }

    async getMeterReadings() {
        return await this._fetch("ivp/meters/readings");
    }

    async getMainProduction() {
        return await this._fetch("api/v1/production");
    }

    async getInverterProduction() {
        return await this._fetch("api/v1/production/inverters");
    }
}

module.exports = async function connect(username, password, endpoint, serial) {
    const api = new Api(username, password);
    await api.login();
    if (endpoint && serial) {
        await api.setEndpoint(endpoint, serial);
    }
    return api;
};
