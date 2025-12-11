require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(
  process.env.FB_SERVICE_KEY_TOKEN,
  "base64"
).toString("utf-8");
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
      "http://localhost:5175",
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Admin verification middleware
const verifyAdmin = async (req, res, next) => {
  const email = req.tokenEmail;
  try {
    const user = await User.findOne({ email });
    if (user && user.role === "admin") {
      next();
    } else {
      res.status(403).send({ message: "Forbidden: Admin access required" });
    }
  } catch (err) {
    res.status(500).send({ message: "Server error", error: err.message });
  }
};

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db("smart-home");

    const usersCollection = db.collection("user");

    const serviceCollection = db.collection("services");

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ data: user });
    });

    // save or update a user in db
    app.post("/user", async (req, res) => {
      const user = req.body;
      user.created_at = new Date().toISOString();
      user.last_loggedIn = new Date().toISOString();
      user.role = "User";

      const email = user.email;
      const userExists = await usersCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      console.log("Saving new user info......");
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/services", async (req, res) => {
      const result = await serviceCollection.find().toArray();
      res.send(result);
    });

    // PATCH: Update User Role
    app.patch("/users/role/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const { role } = req.body; // New role from client (ex: "user")

        const filter = { email: email };
        const updateDoc = {
          $set: { role: role },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);

        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Error updating role" });
      }
    });
   

    app.get("/users", async (req, res) => {
    const users = await usersCollection.find().toArray(); // thik naam
    res.send(users);
});

    // GET /api/services -> list all services (optionally pagination)
    app.get("/api/services", async (req, res) => {
      try {
        const services = await Service.find().sort({ createdAt: -1 });
        res.json({ success: true, data: services });
      } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server iam ready ..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
