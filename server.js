const auth = require('./middleware/auth-mid.js')
const express = require('express')
const server = express();
const sql = require('mssql')
const crypto = require('crypto')
const session = require('express-session')

server.use(express.json())
server.use(express.static('public'))

server.use(session({
    secret: "karanfil-collab-secret",
    resave: false,
    saveUninitialized: false
}))

const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
}

console.log("MSSQL bulut bağlantısı deneniyor...")

sql.connect(config)
.then(() => {
    console.log("Bulut Veritabanı Bağlantısı Sağlandı")
})
.catch((err) => {
    console.log("Bağlantı Başarısız", err)
})

server.post('/register', (req,res) => {
    const username = req.body.username;
    const password = req.body.password;
    const email = req.body.email;

    const request = new sql.Request();

    request.input("username", username);
    request.input("password", password);
    request.input("email", email);

    request.query("INSERT INTO karanfil_collabs_users_tables (email,username,password,created_at) VALUES (@email,@username,@password,GETDATE())")
    .then(() => {
        console.log("Kullanıcı Başarıyla Eklendi");
        res.json({
            "message":"kullanıcı başarıyla eklendi"
        })
    })
    .catch((err) => {
        console.log("kullanıcı eklenemedi", err)
    })
})

server.post('/login', (req,res) => {
    const email = req.body.email;
    const password = req.body.password;

    const request = new sql.Request();

    request.input("email", email);
    request.input("password", password);

    request.query("SELECT * FROM karanfil_collabs_users_tables WHERE email=@email and password=@password")
    .then((result) => {
        if (result.recordset.length > 0) {
            console.log("Giriş Başarılı")
            const user = result.recordset[0]
            console.log(user.id)
            req.session.userId = user.id
            console.log(req.session.userId)
            res.json({
                message: "Giriş Başarılı"
            })
        } else {
            console.log("Email veya şifre hatalı")
            res.json({
                message: "Email veya şifre hatalı"
            })
        }
    })
    .catch((err) => {
        console.log("SQL sorgusunda hata oluştu", err)
        res.status(500).json({
            message: "Sunucu hatası"
        })
    })
})

server.get('/dashboard', auth, async (req, res) => {
    const userId = req.session.userId

    try {
        const request = new sql.Request()
        request.input("userId", userId)

        const userResult = await request.query(`
            SELECT id, username, email, created_at
            FROM karanfil_collabs_users_tables
            WHERE id = @userId
        `)

        if (userResult.recordset.length === 0) {
            return res.status(404).json({
                message: "Kullanıcı bulunamadı"
            })
        }

        const endpointResult = await request.query(`
            SELECT COUNT(*) AS endpointCount
            FROM endpoints_tables
            WHERE user_id = @userId
        `)

        const requestResult = await request.query(`
            SELECT COUNT(*) AS requestCount
            FROM requests_tables
            INNER JOIN endpoints_tables
            ON requests_tables.endpoint_id = endpoints_tables.id
            WHERE endpoints_tables.user_id = @userId
        `)

        res.json({
            user: userResult.recordset[0],
            endpointCount: endpointResult.recordset[0].endpointCount,
            requestCount: requestResult.recordset[0].requestCount
        })

    } catch (err) {
        console.log("Dashboard verileri alınırken hata oluştu", err)
        res.status(500).json({
            message: "Dashboard verileri alınamadı"
        })
    }
})

server.post('/endpoint', auth, (req,res) => {
    const token = crypto.randomBytes(8).toString('hex')
    const userId = req.session.userId

    const request = new sql.Request()

    request.input("token", token)
    request.input("userId", userId)

    request.query("INSERT INTO endpoints_tables (token,user_id,created_at) VALUES (@token,@userId,GETDATE())")
    .then(() => {
        console.log("Endpoint başarıyla oluşturuldu")
        res.json({
            message: "Endpoint oluşturuldu",
            token: token
        })
    })
    .catch((err) => {
        console.log("Endpoint oluşturulamadı", err)
    })
})

server.all('/i/:token', (req,res) => {
    const token = req.params.token
    console.log(token)

    const request = new sql.Request()
    request.input("token", token)

    request.query("SELECT * FROM endpoints_tables WHERE token=@token")
    .then((result) => {
        const endpoint = result.recordset[0]

        if (!endpoint) {
            return res.status(404).json({
                message: "Endpoint bulunamadı"
            })
        }

        const endpointId = endpoint.id
        const requestInsert = new sql.Request()

        requestInsert.input("endpointId", endpointId)
        requestInsert.input("method", req.method)
        requestInsert.input("path", req.path)
        requestInsert.input("headers", JSON.stringify(req.headers))
        requestInsert.input("body", JSON.stringify(req.body))
        requestInsert.input("ip", req.ip)

        requestInsert.query(`
            INSERT INTO requests_tables
            (endpoint_id, method, path, headers, body, ip, created_at)
            VALUES
            (@endpointId, @method, @path, @headers, @body, @ip, GETDATE())
        `)
        .then(() => {
            console.log("İstek başarıyla kaydedildi")
            res.json({
                message: "İstek kaydedildi"
            })
        })
        .catch((err) => {
            console.log("İstek kaydedilemedi", err)
            res.status(500).json({
                message: "İstek kaydedilemedi"
            })
        })
    })
    .catch((err) => {
        console.log("Endpoint aranırken hata oluştu", err)
        res.status(500).json({
            message: "Endpoint aranırken hata oluştu"
        })
    })
})

server.get('/requests', auth, (req,res) => {
    const userId = req.session.userId
    const request = new sql.Request()
    request.input("userId", userId)

    request.query(`
        SELECT requests_tables.*
        FROM requests_tables
        INNER JOIN endpoints_tables
        ON requests_tables.endpoint_id = endpoints_tables.id
        WHERE endpoints_tables.user_id = @userId
    `)
    .then((result) => {
        res.json(result.recordset)
    })
    .catch((err) => {
        console.log("Requestler alınırken hata oluştu", err)
        res.status(500).json({
            message: "Requestler alınamadı"
        })
    })
})

server.get('/requests/:id', auth, (req,res) => {
    const requestsId = req.params.id
    const request = new sql.Request()
    request.input("requestsId", requestsId)

    const userId = req.session.userId
    request.input("userId", userId)

    request.query(`
        SELECT requests_tables.*
        FROM requests_tables
        INNER JOIN endpoints_tables
        ON requests_tables.endpoint_id = endpoints_tables.id
        WHERE requests_tables.id = @requestsId
        AND endpoints_tables.user_id = @userId
    `)
    .then((result) => {
        if (result.recordset.length === 0) {
            return res.status(404).json({
                message: "Request bulunamadı"
            })
        }
        res.json(result.recordset[0])
    })
    .catch((err) => {
        console.log("Request aranırken hata oluştu", err)
        res.status(500).json({
            message: "Request alınamadı"
        })
    })
})

server.get('/endpoints', auth, (req, res) => {
    const userId = req.session.userId
    const request = new sql.Request()
    request.input("userId", userId)

    request.query(`
        SELECT *
        FROM endpoints_tables
        WHERE user_id = @userId
    `)
    .then((result) => {
        res.json(result.recordset)
    })
    .catch((err) => {
        console.log("Endpointler alınırken hata oluştu", err)
        res.status(500).json({
            message: "Endpointler alınamadı"
        })
    })
})

server.get('/endpoints/:id/requests', auth, (req, res) => {
    const endpointId = req.params.id
    const userId = req.session.userId

    const request = new sql.Request()
    request.input("endpointId", endpointId)
    request.input("userId", userId)

    request.query(`
        SELECT requests_tables.*
        FROM requests_tables
        INNER JOIN endpoints_tables
        ON requests_tables.endpoint_id = endpoints_tables.id
        WHERE requests_tables.endpoint_id = @endpointId
        AND endpoints_tables.user_id = @userId
    `)
    .then((result) => {
        res.json(result.recordset)
    })
    .catch((err) => {
        console.log("Endpoint requestleri alınırken hata oluştu", err)
        res.status(500).json({
            message: "Endpoint requestleri alınamadı"
        })
    })
})

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
