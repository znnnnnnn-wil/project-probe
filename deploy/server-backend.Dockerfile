# 使用本机构建并验证的 JAR；不在低内存服务器上编译。
FROM eclipse-temurin:17-jre
WORKDIR /app
RUN useradd --system --uid 10001 app
COPY app.jar /app/app.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java","-Xmx256m","-XX:MaxMetaspaceSize=128m","-jar","/app/app.jar"]
