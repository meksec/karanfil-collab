const auth = (req, res, next) => {
    const userid = req.session.userId;
    if(userid){
       next()
    }else{
       res.status(403).json({
        "message":"giriş yapılmamış"
       })
    }
}

module.exports = auth