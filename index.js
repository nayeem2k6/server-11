require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
      "http://localhost:5173",
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
    req.decoded = decoded;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Admin verification middleware
// const verifyAdmin = async (req, res, next) => {
//   const email = req.decoded.email;
//   try {
//     const user = await usersCollection.findOne({ email });
//     if (user && user.role === "admin") {
//       next();
//     } else {
//       res.status(403).send({ message: "Forbidden: Admin access required" });
//     }
//   } catch (err) {
//     res.status(500).send({ message: "Server error", error: err.message });
//   }
// };

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
    const bookingCollection = db.collection("bookings");

    const usersCollection = db.collection("user");
    const decoratorCollection = db.collection("decorators");

    const serviceCollection = db.collection("services");
    const paymentCollection = db.collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      try {
        const user = await usersCollection.findOne({ email });
        if (user && user.role === "admin") {
          next();
        } else {
          res.status(403).send({ message: "Forbidden: Admin access required" });
        }
      } catch (err) {
        res.status(500).send({ message: "Server error", error: err.message });
      }
    };
    // Decorator Api
    const verifyDecorator = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });

      if (user?.role !== "decorator") {
        return res.status(403).send({ message: "Forbidden" });
      }
      next();
    };

    app.get(
      "/decorator/projects",
      verifyJWT,
      verifyDecorator,
      async (req, res) => {
        const email = req.decoded.email;

        const result = await bookingCollection
          .find({ decoratorEmail: email })
          .toArray();

        res.send(result);
      }
    );
    app.get(
      "/decorator/today",
      verifyJWT,
      verifyDecorator,
      async (req, res) => {
        try {
          const email = req.decoded.email;

          // Bangladesh timezone safe
          const startOfDay = new Date();
          startOfDay.setHours(0, 0, 0, 0);

          const endOfDay = new Date();
          endOfDay.setHours(23, 59, 59, 999);

          const result = await bookingCollection
            .find({
              decoratorEmail: email,
              createdAt: {
                $gte: startOfDay,
                $lte: endOfDay,
              },
            })
            .toArray();

          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    // 5️⃣ Bookings Histogram (date wise count)
    app.get(
      "/admin/bookings-histogram",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const result = await bookingCollection
          .aggregate([
            {
              $group: {
                _id: "$date",
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                date: "$_id",
                count: 1,
              },
            },
            { $sort: { date: 1 } },
          ])
          .toArray();

        res.send(result);
      }
    );

    // 4️⃣ Service Demand Chart
    app.get(
      "/admin/service-demand",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const result = await bookingCollection
          .aggregate([
            {
              $group: {
                _id: "$serviceName",
                count: { $sum: 1 },
              },
            },
            {
              $project: {
                _id: 0,
                service: "$_id",
                count: 1,
              },
            },
            { $sort: { count: -1 } },
          ])
          .toArray();

        res.send(result);
      }
    );
    // app.get(
    //   "/decorator/today",
    //   verifyJWT,
    //   verifyDecorator,
    //   async (req, res) => {
    //     const today = new Date().toISOString().split("T")[0];
    //     const email = req.decoded.email;
    //    console.log(today, email)
    //     const result = await bookingCollection
    //       .find({
    //         decoratorEmail: email,
    //         date: today,
    //       })
    //       .toArray();

    //     res.send(result);
    //   }
    // );

    // app.patch("/admin/decorator/:id", async (req, res) => {
    //   const id = req.params.id;

    //   const result = await decoratorCollection.updateOne(
    //     { _id: new ObjectId(id) },
    //     {
    //       $set: {
    //         status: "approved",
    //         approvedAt: new Date(),
    //       },
    //     }
    //   );

    //   res.send(result);
    // });

    app.patch(
      "/decorator/status/:id",
      verifyJWT,
      verifyDecorator,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;

        const result = await bookingCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status, updatedAt: new Date() } }
        );

        res.send(result);
      }
    );

    app.get(
      "/decorator/earnings",
      verifyJWT,
      verifyDecorator,
      async (req, res) => {
        const email = req.decoded.email;

        const completedJobs = await bookingCollection
          .find({
            decoratorEmail: email,
            status: "completed",
            paymentStatus: "paid",
          })
          .toArray();

        const total = completedJobs.reduce((sum, job) => sum + job.price, 0);

        res.send({
          totalEarnings: total,
          jobs: completedJobs.length,
        });
      }
    );

    app.get(
      "/decorator/payments",
      verifyJWT,
      verifyDecorator,
      async (req, res) => {
        const email = req.decoded.email;

        const payments = await bookingCollection
          .find({
            decoratorEmail: email,
            paymentStatus: "paid",
          })
          .toArray();

        res.send(payments);
      }
    );

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ data: user });
    });
    // payment
    app.post("/create-payment-session", async (req, res) => {
      try {
        const { bookingId, serviceName, cost } = req.body;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: serviceName,
                },
                unit_amount: cost * 100, // Stripe uses cents
              },
              quantity: 1,
            },
          ],
          success_url: `${process.env.CLIENT_URL}/dashboard/payment-success?bookingId=${bookingId}&tx={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_URL}/dashboard/bookings`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Payment session failed" });
      }
    });

    app.patch("/bookings/pay/:id", async (req, res) => {
      const id = req.params.id;

      const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: "Paid",
            paidAt: new Date(),
          },
        }
      );

      res.send(result);
    });

    // app.patch("/bookings/mark-paid/:id", async (req, res) => {
    //   const id = req.params.id;

    //   const result = await bookingCollection.updateOne(
    //     { _id: new ObjectId(id) },
    //     {
    //       $set: {
    //         status: "Paid",
    //         paidAt: new Date(),
    //       },
    //     }
    //   );

    //   res.send(result);
    // });
    app.patch("/bookings/mark-paid/:id", async (req, res) => {
      const id = req.params.id;
      const { transactionId } = req.body;

      const booking = await bookingCollection.findOne({
        _id: new ObjectId(id),
      });

      await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: "Paid",
            paidAt: new Date(),
            transactionId,
          },
        }
      );

      await paymentCollection.insertOne({
        bookingId: id,
        email: booking.userEmail,
        amount: booking.cost,
        transactionId,
        date: new Date(),
        status: "Paid",
      });

      res.send({ success: true });
    });

    app.get("/payments/:email", async (req, res) => {
      const email = req.params.email;

      const result = await paymentCollection
        .find({ email })
        .sort({ date: -1 })
        .toArray();

      res.send(result);
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

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const finalBooking = {
        ...booking,
        status: booking.status || "Pending",
        decoratorEmail: null,
        createdAt: new Date(),
      };
      const result = await bookingCollection.insertOne(finalBooking);
      res.send(result);
    });

    app.patch("/bookings/cancel/:id", async (req, res) => {
      const id = req.params.id;
      const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "Cancelled" } }
      );
      res.send(result);
    });

    // UPDATE booking (date & location)
    app.patch("/bookings/update/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { date, location } = req.body;

        const result = await bookingCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              date,
              location,
              updatedAt: new Date(),
            },
          }
        );

        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to update booking" });
      }
    });

    app.get("/bookings", async (req, res) => {
      const { email } = req.query;
      const query = email ? { userEmail: email } : {};
      const result = await bookingCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/services", async (req, res) => {
      const { search, type, min, max } = req.query;
      let query = {};

      // Search by title
      if (search) {
        query.title = { $regex: search, $options: "i" };
      }

      // Filter by type (you must add a "type" field in DB)
      if (type) {
        query.type = type;
      }

      // Filter min price
      if (min) {
        query.price = { ...query.price, $gte: parseInt(min) };
      }

      // Filter max price
      if (max) {
        query.price = { ...query.price, $lte: parseInt(max) };
      }

      const result = await serviceCollection.find(query).toArray();
      res.send(result);
    });

    app.patch(
      "/admin/assign-decorator/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        try {
          const bookingId = req.params.id;
          const { decoratorEmail } = req.body;

          // 1️⃣ decorator user খুঁজে বের করি
          const decorator = await usersCollection.findOne({
            email: decoratorEmail,
            role: "decorator",
            // status: "approved",
          });

          if (!decorator) {
            return res
              .status(404)
              .send({ message: "Decorator not found or not approved" });
          }

          // 2️⃣ booking update
          const result = await bookingCollection.updateOne(
            { _id: new ObjectId(bookingId), status: "Paid" },
            {
              $set: {
                decoratorEmail: decorator.email,
                decoratorName:
                  decorator.name || decorator.displayName || "Decorator",
                status: "Assigned",
                assignedAt: new Date(),
              },
            }
          );

          res.send(result);
        } catch (err) {
          res
            .status(500)
            .send({ message: "Assign failed", error: err.message });
        }
      }
    );

    app.patch(
      "/admin/decorator/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body; // 👈 frontend থেকে
        console.log(id, status);
        if (!["approved", "disabled"].includes(status)) {
          console.log("test string");
          return res.status(400).send({ message: "Invalid status" });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id), role: "decorator" },
          {
            $set: {
              status,
              updatedAt: new Date(),
            },
          }
        );
        console.log(result);
        res.send(result);
      }
    );

    // app.get("/admin/decorators", async (req, res) => {
    //   const result = await usersCollection
    //     .find({
    //       role: "decorator",
    //       status: { $in: ["pending", "approved", "disabled"] },
    //     })
    //     .project({ email: 1, name: 1, status: 1 })
    //     .toArray();

    //   res.send(result);
    // });

    app.get("/admin/bookings", async (req, res) => {
      const result = await bookingCollection
        .find({ status: { $in: ["Paid", "Assigned"] } })
        .toArray();

      res.send(result);
    });

    app.get("/admin/decorators", async (req, res) => {
      const result = await usersCollection
        .find({ role: "decorator" })

        .project({ email: 1, name: 1 })
        .toArray();

      res.send(result);
    });

    app.get("/services/:id", async (req, res) => {
      const { id } = req.params;
      console.log(id);
      const objectId = new ObjectId(id);
      const result = await serviceCollection.findOne({ _id: objectId });

      res.send({ success: true, result });
    });

    app.delete("/admin/services/:id", async (req, res) => {
      const id = req.params.id;
      const result = await serviceCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.post("/admin/services", verifyJWT, async (req, res) => {
      const { service_name, cost, unit, category, description, image } =
        req.body;

      const service = {
        title: service_name,
        service_name,
        cost: Number(cost),
        unit,
        category,
        description,
        image: image || "",
        createdByEmail: req.decoded.email, // auto fill
        createdAt: new Date(),
      };

      const result = await serviceCollection.insertOne(service);
      res.send(result);
    });

    app.put("/admin/services/:id", async (req, res) => {
      const id = req.params.id;
      const { service_name, cost, unit, category, description, image } =
        req.body;

      const updatedService = {
        $set: {
          title: service_name,
          service_name,
          cost: Number(cost),
          unit,
          category,
          description,
          image: image || "",
          updatedAt: new Date(),
        },
      };

      const result = await serviceCollection.updateOne(
        { _id: new ObjectId(id) },
        updatedService
      );

      res.send(result);
    });

    app.get("/admin/services/:id", async (req, res) => {
      const id = req.params.id;
      const service = await serviceCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(service);
    });

    app.get("/admin/services", async (req, res) => {
      const services = await serviceCollection.find().toArray();
      res.send(services);
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
      const services = await serviceCollection.find().toArray();
      res.send(services);
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
