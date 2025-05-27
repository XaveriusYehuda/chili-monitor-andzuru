module.exports = {
  awsIot: {
    region: 'ap-southeast-1', // Sesuaikan dengan region Anda
    endpoint: 'a2spluztzgsdhl-ats.iot.ap-southeast-1.amazonaws.com', // Ganti dengan endpoint Anda
    clientId: 'vps-express-client',
    thingName: 'raspberry',
    topic1: 'device/ph',
    topic2: 'device/humidity',
  },
  express: {
    port: 3000
  }
};